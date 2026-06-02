import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import { ForbiddenException } from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { InboxMetricasService } from './inbox-metricas.service';

const makePrismaMock = () => ({
  conversation: {
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
  },
  $queryRaw: vi.fn().mockResolvedValue([{ avg_segundos: null }]),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  email: 'sac@x.com',
  nome: 'SAC',
  role: 'SAC' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const minAtras = (m: number) => new Date(Date.now() - m * 60_000);

describe('InboxMetricasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: InboxMetricasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new InboxMetricasService(prisma as never);
  });

  it('sem empresa ativa → ForbiddenException', async () => {
    await expect(service.metricas(fakeUser({ empresaIdAtiva: null }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('agrega contagem por status', async () => {
    prisma.conversation.groupBy.mockResolvedValue([
      { status: 'ABERTA', _count: { _all: 4 } },
      { status: 'RESOLVIDA', _count: { _all: 6 } },
    ]);

    const r = await service.metricas(fakeUser());

    expect(r.conversas.abertas).toBe(4);
    expect(r.conversas.resolvidas).toBe(6);
    expect(r.conversas.total).toBe(10);
  });

  it('snapshot de SLA: separa dentro do prazo x estourado pela idade da última msg', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      // aguardando, recente (dentro do prazo)
      {
        id: 'c1',
        ultimaMsgEm: minAtras(10),
        atribuidoId: 'a1',
        atribuido: { nome: 'Ana' },
        mensagens: [{ direction: 'INBOUND' }],
      },
      // aguardando, antiga (> 120min → estourado)
      {
        id: 'c2',
        ultimaMsgEm: minAtras(200),
        atribuidoId: 'a1',
        atribuido: { nome: 'Ana' },
        mensagens: [{ direction: 'INBOUND' }],
      },
      // última msg nossa → não está aguardando
      {
        id: 'c3',
        ultimaMsgEm: minAtras(5),
        atribuidoId: null,
        atribuido: null,
        mensagens: [{ direction: 'OUTBOUND' }],
      },
    ]);

    const r = await service.metricas(fakeUser());

    expect(r.aguardando.total).toBe(2);
    expect(r.aguardando.dentroDoPrazo).toBe(1);
    expect(r.aguardando.estourado).toBe(1);
    expect(r.aguardando.slaMinutos).toBe(120);
  });

  it('agrupa carga por atendente (abertas + aguardando)', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      {
        id: 'c1',
        ultimaMsgEm: minAtras(10),
        atribuidoId: 'a1',
        atribuido: { nome: 'Ana' },
        mensagens: [{ direction: 'INBOUND' }],
      },
      {
        id: 'c2',
        ultimaMsgEm: minAtras(10),
        atribuidoId: 'a1',
        atribuido: { nome: 'Ana' },
        mensagens: [{ direction: 'OUTBOUND' }],
      },
    ]);

    const r = await service.metricas(fakeUser());

    const ana = r.porAtendente.find((p) => p.atendenteId === 'a1');
    expect(ana).toMatchObject({ atendenteNome: 'Ana', abertas: 2, aguardando: 1 });
  });

  it('tempo médio de 1ª resposta vem do SQL agregado (arredondado)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ avg_segundos: 123.7 }]);

    const r = await service.metricas(fakeUser());
    expect(r.tempoMedioPrimeiraRespostaSegundos).toBe(124);
  });

  it('tempo médio: erro no SQL → null (não derruba o painel)', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('db down'));

    const r = await service.metricas(fakeUser());
    expect(r.tempoMedioPrimeiraRespostaSegundos).toBeNull();
  });
});
