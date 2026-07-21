import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { FunisService } from './funis.service';

const makePrisma = () => ({
  lead: {
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({ _sum: { valorFechado: null } }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  funilEtapa: { findMany: vi.fn().mockResolvedValue([]) },
  // Sem funil de triagem por padrão (empresa que ainda não usa triagem).
  funil: { findMany: vi.fn().mockResolvedValue([]) },
  conversation: { count: vi.fn().mockResolvedValue(0) },
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

describe('FunisService.atribuicaoPorCampanha', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: FunisService;

  beforeEach(() => {
    prisma = makePrisma();
    const repScope = {
      getRepIds: vi.fn(async (u: AuthenticatedUser) => (u.role === 'REP' ? [u.id] : null)),
    };
    svc = new FunisService(prisma as never, repScope as never);
  });

  it('utmCampaign presente → where com empresaId + igualdade; agrega etapas + valorPonderado', async () => {
    // groupBy por etapa: 1 lead na etapa custom "Nutrição (frio)" (prob 20), valor 1000.
    prisma.lead.count
      .mockResolvedValueOnce(1) // total
      .mockResolvedValueOnce(0) // ganhos
      .mockResolvedValueOnce(0); // perdidos
    prisma.lead.groupBy
      .mockResolvedValueOnce([
        {
          funilEtapaId: 'et-nutri',
          etapa: 'NOVO',
          _count: { _all: 1 },
          _sum: { valorEstimado: new Prisma.Decimal(1000) },
        },
      ])
      .mockResolvedValueOnce([{ origemCadastro: 'site', _count: { _all: 1 } }]);
    prisma.funilEtapa.findMany.mockResolvedValue([
      { id: 'et-nutri', nome: 'Nutrição (frio)', probabilidade: 20 },
    ]);

    const r = await svc.atribuicaoPorCampanha(admin, { utmCampaign: 'validacao_e2e' });

    const where = prisma.lead.count.mock.calls[0][0].where;
    expect(where).toMatchObject({ empresaId: 'emp-1', utmCampaign: 'validacao_e2e' });
    expect(where.representanteId).toBeUndefined(); // admin sem escopo

    expect(r.totalLeads).toBe(1);
    expect(r.leadsPorEtapa[0]).toMatchObject({
      etapaId: 'et-nutri',
      nome: 'Nutrição (frio)',
      quantidade: 1,
      valorEstimado: 1000,
    });
    // valorPonderado = 1000 × 20 / 100 = 200
    expect(r.valorPonderado).toBe(200);
    expect(r.porOrigemCadastro).toEqual([{ origemCadastro: 'site', quantidade: 1 }]);
    expect(r.utmCampaign).toBe('validacao_e2e');
  });

  it('utmCampaign AUSENTE → filtra leads SEM atribuição (utmCampaign IS NULL)', async () => {
    await svc.atribuicaoPorCampanha(admin, {});
    expect(prisma.lead.count.mock.calls[0][0].where.utmCampaign).toBeNull();
  });

  it('REP: aplica escopo de carteira (representanteId)', async () => {
    await svc.atribuicaoPorCampanha(rep, { utmCampaign: 'x' });
    expect(prisma.lead.count.mock.calls[0][0].where.representanteId).toEqual({ in: ['rep-1'] });
  });

  it('filtros por origemCadastro/source/medium + período entram no where', async () => {
    await svc.atribuicaoPorCampanha(admin, {
      utmCampaign: 'x',
      origemCadastro: 'meta_lead_ads',
      utmSource: 'facebook',
      utmMedium: 'paid',
      dataInicio: '2026-08-01T00:00:00.000Z',
      dataFim: '2026-08-31T00:00:00.000Z',
    });
    const where = prisma.lead.count.mock.calls[0][0].where;
    expect(where).toMatchObject({
      origemCadastro: 'meta_lead_ads',
      utmSource: 'facebook',
      utmMedium: 'paid',
    });
    expect(where.criadoEm.gte).toBeInstanceOf(Date);
    expect(where.criadoEm.lte).toBeInstanceOf(Date);
  });

  it('cicloMedioDias: média de dias captura→fechamento dos GANHOS', async () => {
    prisma.lead.findMany.mockResolvedValue([
      { criadoEm: new Date('2026-08-01T00:00:00Z'), fechadoEm: new Date('2026-08-11T00:00:00Z') }, // 10d
      { criadoEm: new Date('2026-08-01T00:00:00Z'), fechadoEm: new Date('2026-08-05T00:00:00Z') }, // 4d
    ]);
    const r = await svc.atribuicaoPorCampanha(admin, { utmCampaign: 'x' });
    expect(r.cicloMedioDias).toBe(7);
  });
  it('SEPARA descartado na triagem de perdido de verdade (não podem se misturar)', async () => {
    prisma.funil.findMany.mockResolvedValue([{ id: 'funil-triagem' }]);
    prisma.lead.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(2) // ganhos
      .mockResolvedValueOnce(3) // perdidos (COMERCIAL — já exclui triagem no where)
      .mockResolvedValueOnce(5); // descartadosTriagem

    const r = await svc.atribuicaoPorCampanha(admin, { utmCampaign: 'ctwa-verao' });

    expect(r.perdidos).toBe(3);
    expect(r.descartadosTriagem).toBe(5);
    // Perda comercial EXCLUI o funil de triagem — mas mantém lead sem funil
    // ('notIn' sozinho descartaria os NULL no Postgres).
    const wherePerda = prisma.lead.count.mock.calls[2][0].where;
    expect(wherePerda).toMatchObject({ etapa: 'PERDIDO' });
    expect(wherePerda.OR).toEqual([{ funilId: null }, { funilId: { notIn: ['funil-triagem'] } }]);
    // Descarte é o espelho: SÓ o funil de triagem.
    expect(prisma.lead.count.mock.calls[3][0].where).toMatchObject({
      etapa: 'PERDIDO',
      funilId: { in: ['funil-triagem'] },
    });
  });

  it('sem funil de triagem: descartadosTriagem = 0 e perda comercial sem filtro extra', async () => {
    prisma.lead.count.mockResolvedValue(4);

    const r = await svc.atribuicaoPorCampanha(admin, { utmCampaign: 'x' });

    expect(r.descartadosTriagem).toBe(0);
    // Empresa sem triagem não paga query nem ganha OR à toa.
    expect(prisma.lead.count.mock.calls[2][0].where.OR).toBeUndefined();
  });

  it('camada de CONVERSA: total, quantas viraram lead e a taxa', async () => {
    prisma.conversation.count
      .mockResolvedValueOnce(300) // conversas da campanha
      .mockResolvedValueOnce(12); // viraram lead

    const r = await svc.atribuicaoPorCampanha(admin, { utmCampaign: 'ctwa-verao' });

    expect(r.totalConversas).toBe(300);
    expect(r.conversasQueViraramLead).toBe(12);
    expect(r.taxaConversaParaLead).toBe(4);
    // Agrupa pela COLUNA indexada da Conversation (não por JSON).
    expect(prisma.conversation.count.mock.calls[0][0].where).toMatchObject({
      empresaId: 'emp-1',
      utmCampaign: 'ctwa-verao',
    });
    expect(prisma.conversation.count.mock.calls[1][0].where.leadId).toEqual({ not: null });
  });

  it('sem conversa nenhuma, taxa é 0 (não divide por zero)', async () => {
    const r = await svc.atribuicaoPorCampanha(admin, { utmCampaign: 'x' });
    expect(r.taxaConversaParaLead).toBe(0);
  });

  it('REP: camada de conversa respeita a carteira (WhatsApp pessoal tem dono)', async () => {
    await svc.atribuicaoPorCampanha(rep, { utmCampaign: 'x' });
    expect(prisma.conversation.count.mock.calls[0][0].where.proprietarioId).toEqual({
      in: ['rep-1'],
    });
  });
});
