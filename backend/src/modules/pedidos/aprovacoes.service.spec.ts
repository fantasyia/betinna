import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { AprovacoesService } from './aprovacoes.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;

// Shared tx mock used by $transaction callback
const makeTxMock = () => ({
  aprovacaoDesconto: {
    update: vi.fn(),
  } satisfies MockModel,
  pedido: {
    update: vi.fn(),
  } satisfies MockModel,
});

const makePrismaMock = () => {
  const tx = makeTxMock();
  return {
    aprovacaoDesconto: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    } satisfies MockModel,
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    _tx: tx, // expose for assertions
  };
};

const makeRepScopeMock = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return ['rep-a', 'rep-b'];
    return null; // ADMIN/DIRECTOR/SAC
  }),
});

const makeBusMock = () => ({
  disparar: vi.fn().mockResolvedValue(undefined),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'gerente-1',
  email: 'gerente@betinna.ai',
  nome: 'Gerente',
  role: 'GERENTE' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeAprovacao = (overrides: Record<string, unknown> = {}) => ({
  id: 'apr-1',
  pedidoId: 'ped-1',
  representanteId: 'rep-a',
  gerenteId: null,
  status: 'PENDENTE',
  percentualDesconto: 20,
  motivo: 'Pedido grande',
  comentarioAprovador: null,
  resolvidoEm: null,
  criadoEm: new Date('2026-06-01'),
  atualizadoEm: new Date('2026-06-01'),
  pedido: {
    id: 'ped-1',
    numero: 'PED-0001',
    total: 1000,
    status: 'AGUARDANDO_APROVACAO',
    empresaId: 'emp-1',
    clienteId: 'cli-1',
    cliente: { id: 'cli-1', nome: 'Cliente X' },
    itens: [],
  },
  representante: { id: 'rep-a', nome: 'Rep A', email: 'rep@betinna.ai', tetoDesconto: 15 },
  gerente: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AprovacoesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repScope: ReturnType<typeof makeRepScopeMock>;
  let bus: ReturnType<typeof makeBusMock>;
  let service: AprovacoesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    repScope = makeRepScopeMock();
    bus = makeBusMock();
    service = new AprovacoesService(
      prisma as never,
      repScope as never,
      bus as never,
      {
        criarParaUsuario: vi.fn().mockResolvedValue(null),
        criarParaRole: vi.fn().mockResolvedValue(0),
      } as never,
      {
        enviarAprovacaoResolvida: vi.fn().mockResolvedValue({ ok: true }),
        enviarBoasVindas: vi.fn().mockResolvedValue({ ok: true }),
        enviarComissaoFechada: vi.fn().mockResolvedValue({ ok: true }),
        enviarOcorrenciaCritica: vi.fn().mockResolvedValue({ ok: true }),
        enviarAmostraFollowup: vi.fn().mockResolvedValue({ ok: true }),
      } as never,
    );
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    const baseParams = { page: 1, limit: 20 };

    it('lista aprovações com filtro de empresa', async () => {
      prisma.aprovacaoDesconto.count.mockResolvedValue(1);
      prisma.aprovacaoDesconto.findMany.mockResolvedValue([fakeAprovacao()]);

      const result = await service.list(fakeUser(), baseParams);

      expect(result.data).toHaveLength(1);
      const where = prisma.aprovacaoDesconto.findMany.mock.calls[0][0].where;
      expect(where.pedido.empresaId).toBe('emp-1');
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.list(fakeUser({ empresaIdAtiva: null }), baseParams),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('REP vê apenas as próprias aprovações (scope = [user.id])', async () => {
      prisma.aprovacaoDesconto.count.mockResolvedValue(0);
      prisma.aprovacaoDesconto.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'REP', id: 'rep-99' }), baseParams);

      const where = prisma.aprovacaoDesconto.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toEqual({ in: ['rep-99'] });
    });

    it('GERENTE vê aprovações dos REPs sob sua gerência', async () => {
      prisma.aprovacaoDesconto.count.mockResolvedValue(0);
      prisma.aprovacaoDesconto.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'GERENTE', id: 'ger-1' }), baseParams);

      const where = prisma.aprovacaoDesconto.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toEqual({ in: ['rep-a', 'rep-b'] });
    });

    it('ADMIN não tem filtro de scope (vê tudo)', async () => {
      prisma.aprovacaoDesconto.count.mockResolvedValue(0);
      prisma.aprovacaoDesconto.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'ADMIN' }), baseParams);

      const where = prisma.aprovacaoDesconto.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toBeUndefined();
    });

    it('filtra por status quando passado', async () => {
      prisma.aprovacaoDesconto.count.mockResolvedValue(0);
      prisma.aprovacaoDesconto.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'ADMIN' }), {
        ...baseParams,
        status: 'PENDENTE' as never,
      });

      const where = prisma.aprovacaoDesconto.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('PENDENTE');
    });

    it('filtra por representanteId dentro do scope', async () => {
      prisma.aprovacaoDesconto.count.mockResolvedValue(0);
      prisma.aprovacaoDesconto.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'GERENTE' }), {
        ...baseParams,
        representanteId: 'rep-a',
      });

      const where = prisma.aprovacaoDesconto.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toBe('rep-a');
    });

    it('representanteId fora do scope GERENTE retorna vazio (__none__)', async () => {
      prisma.aprovacaoDesconto.count.mockResolvedValue(0);
      prisma.aprovacaoDesconto.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'GERENTE' }), {
        ...baseParams,
        representanteId: 'rep-fora',
      });

      const where = prisma.aprovacaoDesconto.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toBe('__none__');
    });

    it('retorna paginação correta', async () => {
      prisma.aprovacaoDesconto.count.mockResolvedValue(100);
      prisma.aprovacaoDesconto.findMany.mockResolvedValue([]);

      const result = await service.list(fakeUser({ role: 'ADMIN' }), { page: 3, limit: 10 });

      expect(result.pagination.total).toBe(100);
      expect(result.pagination.page).toBe(3);
      expect(result.pagination.totalPages).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna aprovação quando encontrada e dentro do scope', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-a' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      const result = await service.findById(fakeUser({ role: 'GERENTE' }), 'apr-1');

      expect(result).toEqual(apr);
    });

    it('lança NotFoundException quando aprovação não existe', async () => {
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('GERENTE lança ForbiddenException para aprovação fora da gerência', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-fora' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(service.findById(fakeUser({ role: 'GERENTE' }), 'apr-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('ADMIN acessa qualquer aprovação sem restrição de scope', async () => {
      const apr = fakeAprovacao({ representanteId: 'qualquer-rep' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(service.findById(fakeUser({ role: 'ADMIN' }), 'apr-1')).resolves.toBeDefined();
    });

    it('lança ForbiddenException sem empresaIdAtiva', async () => {
      await expect(
        service.findById(fakeUser({ empresaIdAtiva: null }), 'apr-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // -------------------------------------------------------------------------
  // aprovar
  // -------------------------------------------------------------------------

  describe('aprovar', () => {
    const dto = { comentario: 'Ok, aprovado' };

    it('aprova aprovação PENDENTE e atualiza pedido para RASCUNHO', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-a', status: 'PENDENTE' });
      const updatedApr = fakeAprovacao({ status: 'APROVADA' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);
      const txMock = prisma._tx;
      txMock.aprovacaoDesconto.update.mockResolvedValue(updatedApr);
      txMock.pedido.update.mockResolvedValue({});

      const result = await service.aprovar(
        fakeUser({ role: 'ADMIN', id: 'admin-1' }),
        'apr-1',
        dto,
      );

      expect(result.status).toBe('APROVADA');
      expect(txMock.aprovacaoDesconto.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'APROVADA', resolvidoEm: expect.any(Date) }),
        }),
      );
      expect(txMock.pedido.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ped-1' },
          data: { status: 'RASCUNHO', aprovadorId: 'admin-1' },
        }),
      );
    });

    it('dispara evento PEDIDO_APROVADO após aprovação', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-a', status: 'PENDENTE' });
      const updatedApr = fakeAprovacao({ status: 'APROVADA' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);
      prisma._tx.aprovacaoDesconto.update.mockResolvedValue(updatedApr);
      prisma._tx.pedido.update.mockResolvedValue({});

      await service.aprovar(fakeUser({ role: 'ADMIN', id: 'admin-1' }), 'apr-1', dto);

      expect(bus.disparar).toHaveBeenCalledWith(
        'emp-1',
        'PEDIDO_APROVADO',
        expect.objectContaining({ pedidoId: 'ped-1' }),
      );
    });

    it('REP lança ForbiddenException ao tentar aprovar', async () => {
      const apr = fakeAprovacao({ representanteId: 'outro-rep', status: 'PENDENTE' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(
        service.aprovar(fakeUser({ role: 'REP', id: 'rep-1' }), 'apr-1', dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('SAC lança ForbiddenException ao tentar aprovar', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-a', status: 'PENDENTE' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(service.aprovar(fakeUser({ role: 'SAC' }), 'apr-1', dto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lança BusinessRuleException para aprovação já resolvida (não PENDENTE)', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-a', status: 'APROVADA' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(
        service.aprovar(fakeUser({ role: 'ADMIN' }), 'apr-1', dto),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException quando aprovador é o próprio representante', async () => {
      // ADMIN (scope=null) para que findById não lance ForbiddenException antes da checagem
      const apr = fakeAprovacao({ representanteId: 'admin-1', status: 'PENDENTE' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(
        service.aprovar(fakeUser({ role: 'ADMIN', id: 'admin-1' }), 'apr-1', dto),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });
  });

  // -------------------------------------------------------------------------
  // rejeitar
  // -------------------------------------------------------------------------

  describe('rejeitar', () => {
    const dto = { comentario: 'Desconto excessivo' };

    it('rejeita aprovação PENDENTE e cancela pedido', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-a', status: 'PENDENTE' });
      const updatedApr = fakeAprovacao({ status: 'REJEITADA' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);
      prisma._tx.aprovacaoDesconto.update.mockResolvedValue(updatedApr);
      prisma._tx.pedido.update.mockResolvedValue({});

      const result = await service.rejeitar(
        fakeUser({ role: 'ADMIN', id: 'admin-1' }),
        'apr-1',
        dto,
      );

      expect(result.status).toBe('REJEITADA');
      expect(prisma._tx.pedido.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ped-1' },
          data: { status: 'CANCELADO' },
        }),
      );
    });

    it('lança BusinessRuleException para aprovação já resolvida', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-a', status: 'REJEITADA' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(
        service.rejeitar(fakeUser({ role: 'ADMIN' }), 'apr-1', dto),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('lança BusinessRuleException quando rejeitor é o próprio representante', async () => {
      // ADMIN (scope=null) para que findById não lance ForbiddenException antes da checagem
      const apr = fakeAprovacao({ representanteId: 'admin-1', status: 'PENDENTE' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(
        service.rejeitar(fakeUser({ role: 'ADMIN', id: 'admin-1' }), 'apr-1', dto),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('REP lança ForbiddenException ao tentar rejeitar', async () => {
      const apr = fakeAprovacao({ representanteId: 'outro-rep', status: 'PENDENTE' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);

      await expect(
        service.rejeitar(fakeUser({ role: 'REP', id: 'rep-1' }), 'apr-1', dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('não dispara evento ao rejeitar', async () => {
      const apr = fakeAprovacao({ representanteId: 'rep-a', status: 'PENDENTE' });
      prisma.aprovacaoDesconto.findFirst.mockResolvedValue(apr);
      prisma._tx.aprovacaoDesconto.update.mockResolvedValue(fakeAprovacao({ status: 'REJEITADA' }));
      prisma._tx.pedido.update.mockResolvedValue({});

      await service.rejeitar(fakeUser({ role: 'ADMIN' }), 'apr-1', dto);

      expect(bus.disparar).not.toHaveBeenCalled();
    });
  });
});
