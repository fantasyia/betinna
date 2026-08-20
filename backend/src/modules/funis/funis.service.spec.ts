import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { BusinessRuleException } from '@shared/errors/app-exception';
import { FunisService } from './funis.service';

const makePrisma = () => {
  const p: Record<string, unknown> = {
    funil: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
    funilEtapa: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    lead: {
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    // #29: remove/create/update/removerEtapa usam transação interativa — o default
    // roda o callback contra o próprio mock (senão o corpo da transação some e o
    // teste passa sem exercitar nada).
    $transaction: vi.fn(),
  };
  p.$transaction = vi.fn((cb: unknown) =>
    typeof cb === 'function' ? (cb as (t: unknown) => unknown)(p) : Promise.all(cb as unknown[]),
  );
  return p as never as {
    funil: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      update?: ReturnType<typeof vi.fn>;
      updateMany?: ReturnType<typeof vi.fn>;
    };
    funilEtapa: {
      findFirst: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      update?: ReturnType<typeof vi.fn>;
    };
    lead: { groupBy: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
    $queryRaw: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    $transaction: ReturnType<typeof vi.fn>;
  };
};

const admin: AuthenticatedUser = {
  id: 'adm',
  email: 'a@b.ai',
  nome: 'Admin',
  role: 'DIRECTOR',
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
};

const fakeFunil = (etapas: Array<{ id: string; nome: string }>) => ({
  id: 'f1',
  empresaId: 'emp-1',
  nome: 'Funil X',
  protegido: false,
  isPadrao: false,
  _count: { leads: 0 },
  etapas: etapas.map((e, i) => ({
    id: e.id,
    nome: e.nome,
    ordem: i,
    tipo: 'ATIVA',
    probabilidade: 10,
    slaDias: null,
    slaHoras: null,
    capacidadeMaxima: null,
    acaoSlaExpirado: null,
  })),
});

describe('FunisService — uso de etapa (leadsCount + fluxosQueApontam)', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: FunisService;

  beforeEach(() => {
    prisma = makePrisma();
    // `comUso` consulta o RepScope pra filtrar a contagem por carteira — sem o
    // mock, o service quebra ao decorar as etapas.
    svc = new FunisService(
      prisma as never,
      {
        getRepIds: vi.fn().mockResolvedValue(null),
      } as never,
    );
  });

  it('findById decora cada etapa com leadsCount e fluxosQueApontam', async () => {
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Novo' }]));
    prisma.lead.groupBy.mockResolvedValue([{ funilEtapaId: 'et-1', _count: 3 }]);
    prisma.$queryRaw.mockResolvedValue([
      { etapaId: 'et-1', id: 'flx-1', nome: 'T1', status: 'ATIVO', acaoTipo: 'MOVER_LEAD_ETAPA' },
    ]);

    const funil = await svc.findById(admin, 'f1');

    expect(funil.etapas[0].leadsCount).toBe(3);
    expect(funil.etapas[0].fluxosQueApontam).toEqual([
      { id: 'flx-1', nome: 'T1', status: 'ATIVO', acaoTipo: 'MOVER_LEAD_ETAPA' },
    ]);
  });

  it('removerEtapa BLOQUEIA quando há lead na etapa', async () => {
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Novo' }]));
    prisma.lead.groupBy.mockResolvedValue([{ funilEtapaId: 'et-1', _count: 2 }]);
    // #29: a checagem que vale é a re-contagem DENTRO da transação.
    prisma.lead.count.mockResolvedValue(2);

    await expect(svc.removerEtapa(admin, 'f1', 'et-1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(prisma.funilEtapa.delete).not.toHaveBeenCalled();
  });

  it('removerEtapa BLOQUEIA quando um fluxo aponta pra etapa (mesmo sem lead)', async () => {
    // Caso real do card: etapa sem lead mas com CRIAR_LEAD/MOVER_LEAD_ETAPA apontando —
    // apagar quebraria o fluxo silenciosamente.
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Novo' }]));
    prisma.$queryRaw.mockResolvedValue([
      { etapaId: 'et-1', id: 'flx-1', nome: 'T1', status: 'ATIVO', acaoTipo: 'CRIAR_LEAD' },
    ]);

    await expect(svc.removerEtapa(admin, 'f1', 'et-1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(prisma.funilEtapa.delete).not.toHaveBeenCalled();
  });

  it('removerEtapa PROSSEGUE quando não há lead nem fluxo apontando', async () => {
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Novo' }]));

    await svc.removerEtapa(admin, 'f1', 'et-1');

    expect(prisma.funilEtapa.delete).toHaveBeenCalledWith({ where: { id: 'et-1' } });
  });

  it('atualizarEtapa faz UPDATE (preserva o id) — não apaga e recria', async () => {
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Novo' }]));
    prisma.funilEtapa.findFirst.mockResolvedValue({ id: 'et-1', funilId: 'f1', nome: 'Novo' });
    prisma.funilEtapa.update = vi.fn().mockResolvedValue({});

    await svc.atualizarEtapa(admin, 'f1', 'et-1', { nome: 'Em conversa' });

    expect(prisma.funilEtapa.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'et-1' } }),
    );
    expect(prisma.funilEtapa.delete).not.toHaveBeenCalled();
  });

  it('AVISA quando o rename quebra uma CONDICAO que compara a etapa por NOME', async () => {
    // O rename preserva o id (seguro pros nós MOVER_LEAD_ETAPA), mas condição que
    // compara `lead.etapa_atual` por string para de casar EM SILÊNCIO. Tem que avisar.
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Descartado' }]));
    prisma.funilEtapa.findFirst.mockResolvedValue({
      id: 'et-1',
      funilId: 'f1',
      nome: 'Descartado',
    });
    prisma.funilEtapa.update = vi.fn().mockResolvedValue({});
    // 1ª chamada = fluxosQueApontam (findById inicial); 2ª = condicoesQueComparamPorNome
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ fluxoNome: 'T1', noTitulo: 'Estava em Descartado?' }])
      .mockResolvedValue([]);

    const r = await svc.atualizarEtapa(admin, 'f1', 'et-1', { nome: 'Arquivado' });

    expect(r.avisos).toHaveLength(1);
    expect(r.avisos?.[0]).toContain('T1');
    expect(r.avisos?.[0]).toContain('lead.etapa_id');
  });

  it('NÃO avisa quando o rename não afeta condição nenhuma', async () => {
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Novo' }]));
    prisma.funilEtapa.findFirst.mockResolvedValue({ id: 'et-1', funilId: 'f1', nome: 'Novo' });
    prisma.funilEtapa.update = vi.fn().mockResolvedValue({});

    const r = await svc.atualizarEtapa(admin, 'f1', 'et-1', { nome: 'Em conversa' });

    expect(r.avisos).toBeUndefined();
  });

  it('NÃO checa condições quando o update não mexe no nome (só cor/SLA)', async () => {
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Novo' }]));
    prisma.funilEtapa.findFirst.mockResolvedValue({ id: 'et-1', funilId: 'f1', nome: 'Novo' });
    prisma.funilEtapa.update = vi.fn().mockResolvedValue({});
    prisma.$queryRaw.mockClear();

    await svc.atualizarEtapa(admin, 'f1', 'et-1', { slaDias: 5 });

    // Só as chamadas dos dois findById (fluxosQueApontam) — nenhuma busca de condição.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe('FunisService.remove — corrida com lead novo (#29)', () => {
  const montar = () => {
    const prisma = makePrisma();
    // Transação interativa: roda o callback com o MESMO mock (o tx é o prisma).
    prisma.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(prisma));
    prisma.funil.findFirst.mockResolvedValue({
      id: 'f1',
      empresaId: 'emp-1',
      nome: 'Funil',
      isPadrao: false,
      protegido: false,
      etapas: [],
      _count: { leads: 0 },
    });
    return {
      prisma,
      svc: new FunisService(
        prisma as never,
        { getRepIds: vi.fn().mockResolvedValue(null) } as never,
      ),
    };
  };

  it('lead criado DEPOIS da checagem inicial impede o delete (re-contagem na tx)', async () => {
    const { prisma, svc } = montar();
    // findById viu 0 leads; dentro da transação já existe 1 (captura do site,
    // importação, triagem entrando na janela). Antes, o funil era apagado e o
    // lead virava órfão por SetNull — sumia de todo kanban, sem erro.
    prisma.lead.count.mockResolvedValue(1);

    await expect(svc.remove(admin, 'f1')).rejects.toThrow(/1 lead/);
    expect(prisma.funil.delete).not.toHaveBeenCalled();
  });

  it('sem lead na janela, apaga normalmente', async () => {
    const { prisma, svc } = montar();
    prisma.lead.count.mockResolvedValue(0);

    await svc.remove(admin, 'f1');

    expect(prisma.funil.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
  });
});

/**
 * #29: os dois check-then-act que sobraram no service.
 */
describe('FunisService — corridas do #29', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: FunisService;

  beforeEach(() => {
    prisma = makePrisma();
    svc = new FunisService(
      prisma as never,
      { getRepIds: vi.fn().mockResolvedValue(null) } as never,
    );
    prisma.funil.update = vi.fn().mockResolvedValue({});
    prisma.funil.updateMany = vi.fn().mockResolvedValue({ count: 0 });
  });

  it('lead que entra na etapa DEPOIS da leitura bloqueia o delete (re-conta na transação)', async () => {
    prisma.funil.findFirst.mockResolvedValue(fakeFunil([{ id: 'et-1', nome: 'Novo' }]));
    // A leitura do findById viu 0 leads…
    prisma.lead.groupBy.mockResolvedValue([]);
    // …mas na hora de apagar já tem 1 (capturado do site no meio do caminho).
    prisma.lead.count.mockResolvedValue(1);

    await expect(svc.removerEtapa(admin, 'f1', 'et-1')).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    expect(prisma.funilEtapa.delete).not.toHaveBeenCalled();
  });

  it('promover funil a padrão desmarca os outros na MESMA transação', async () => {
    prisma.funil.findFirst.mockResolvedValue({ ...fakeFunil([]), isPadrao: false });

    await svc.update(admin, 'f1', { isPadrao: true } as never);

    // Advisory lock por empresa + desmarcação + marcação, tudo no mesmo tx.
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.funil.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPadrao: true, id: { not: 'f1' } }),
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
