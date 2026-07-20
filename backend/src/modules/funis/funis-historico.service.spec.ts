import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { FunisService } from './funis.service';

const makePrisma = () => ({
  leadEtapaHistorico: {
    count: vi.fn().mockResolvedValue(1),
    findMany: vi.fn().mockResolvedValue([]),
  },
  funilEtapa: { findMany: vi.fn().mockResolvedValue([]) },
  usuario: { findMany: vi.fn().mockResolvedValue([]) },
});

const admin: AuthenticatedUser = {
  id: 'adm',
  email: 'a@b.ai',
  nome: 'Admin',
  role: 'DIRECTOR',
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
};
const rep: AuthenticatedUser = { ...admin, id: 'rep-1', role: 'REP' };

describe('FunisService.historicoEtapas', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: FunisService;

  beforeEach(() => {
    prisma = makePrisma();
    const repScope = {
      getRepIds: vi.fn(async (u: AuthenticatedUser) => (u.role === 'REP' ? [u.id] : null)),
    };
    svc = new FunisService(prisma as never, repScope as never);
  });

  it('filtra por funil/lead/período e resolve nomes de etapa + quem', async () => {
    prisma.leadEtapaHistorico.findMany.mockResolvedValue([
      {
        leadId: 'l1',
        funilId: 'f1',
        etapaOrigem: 'et-a',
        etapaDestino: 'et-b',
        quem: 'u1',
        origemMudanca: 'manual',
        ocorridoEm: new Date('2026-08-01T10:00:00Z'),
        lead: { nome: 'Lead 1', contatoNome: 'Contato 1' },
      },
    ]);
    prisma.funilEtapa.findMany.mockResolvedValue([
      { id: 'et-a', nome: 'Novo' },
      { id: 'et-b', nome: 'Qualificação' },
    ]);
    prisma.usuario.findMany.mockResolvedValue([{ id: 'u1', nome: 'Rep João' }]);

    const r = await svc.historicoEtapas(admin, {
      funilId: 'f1',
      de: '2026-08-01T00:00:00.000Z',
      ate: '2026-08-31T23:59:59.000Z',
      page: 1,
      limit: 50,
    });

    // where com funil + período; SEM filtro de carteira (admin scope=null)
    const where = prisma.leadEtapaHistorico.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ empresaId: 'emp-1', funilId: 'f1' });
    expect(where.ocorridoEm.gte).toBeInstanceOf(Date);
    expect(where.lead).toBeUndefined();

    expect(r.data[0]).toMatchObject({
      leadId: 'l1',
      leadNome: 'Contato 1',
      etapaOrigem: { id: 'et-a', nome: 'Novo' },
      etapaDestino: { id: 'et-b', nome: 'Qualificação' },
      quem: { id: 'u1', nome: 'Rep João' },
      origemMudanca: 'manual',
    });
  });

  it('REP: aplica escopo de carteira via relação lead.representanteId', async () => {
    await svc.historicoEtapas(rep, { leadId: 'l9', page: 1, limit: 50 });
    const where = prisma.leadEtapaHistorico.findMany.mock.calls[0][0].where;
    expect(where.lead).toEqual({ representanteId: { in: ['rep-1'] } });
    // leadId → ordem cronológica asc (trajetória)
    expect(prisma.leadEtapaHistorico.findMany.mock.calls[0][0].orderBy).toEqual({
      ocorridoEm: 'asc',
    });
  });

  it('etapa que não é funilEtapa (enum legado) → usa o valor cru como nome', async () => {
    prisma.leadEtapaHistorico.findMany.mockResolvedValue([
      {
        leadId: 'l1',
        funilId: null,
        etapaOrigem: null,
        etapaDestino: 'GANHO',
        quem: null,
        origemMudanca: 'fluxo',
        ocorridoEm: new Date('2026-08-02T10:00:00Z'),
        lead: { nome: 'L', contatoNome: null },
      },
    ]);
    const r = await svc.historicoEtapas(admin, { page: 1, limit: 50 });
    expect(r.data[0].etapaOrigem).toBeNull();
    expect(r.data[0].etapaDestino).toEqual({ id: 'GANHO', nome: 'GANHO' });
    expect(r.data[0].quem).toBeNull();
  });
});
