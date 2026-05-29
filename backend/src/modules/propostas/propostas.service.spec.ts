import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { UserRole } from '@prisma/client';
import {
  BusinessRuleException,
  ForbiddenException,
  NotFoundException,
} from '@shared/errors/app-exception';
import type { AuthenticatedUser } from '@shared/types/authenticated-user';
import { PropostasService } from './propostas.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockModel = Record<string, ReturnType<typeof vi.fn>>;
type Tx = { pedido: MockModel; proposta: MockModel };

const makePrismaMock = () => {
  const tx: Tx = {
    pedido: { create: vi.fn() },
    proposta: { updateMany: vi.fn() },
  };
  return {
    proposta: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    } satisfies MockModel,
    pedido: {
      create: vi.fn(),
    } satisfies MockModel,
    cliente: { findFirst: vi.fn() } satisfies MockModel,
    produto: { findMany: vi.fn() } satisfies MockModel,
    empresa: { findUnique: vi.fn(async () => ({ descontoPixPct: 0, descontoBoletoAvistaPct: 0 })) } satisfies MockModel,
    $transaction: vi.fn(async (cb: (t: Tx) => unknown) => cb(tx)),
    _tx: tx, // expose for assertions
  };
};

const makeRepScope = () => ({
  getRepIds: vi.fn(async (u: AuthenticatedUser) => {
    if (u.role === 'REP') return [u.id];
    if (u.role === 'GERENTE') return ['rep-a'];
    return null;
  }),
});

const makePricing = () => ({
  priceForClientBatch: vi.fn(async () => new Map()),
});

const makePedidoPricing = () => ({
  pedidoTotals: vi.fn(() => ({ subtotal: 100, total: 100, comissao: 5 })),
  descontoAVistaPct: vi.fn(() => 0),
  itemTotal: vi.fn((i: { quantidade: number; precoUnitario: number; desconto: number }) => ({
    total: i.quantidade * i.precoUnitario * (1 - i.desconto / 100),
  })),
});

const makeSequence = () => ({
  next: vi.fn(async () => 1),
});

const fakeUser = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'admin-1',
  email: 'admin@betinna.ai',
  nome: 'Admin',
  role: 'ADMIN' as UserRole,
  empresaIds: ['emp-1'],
  empresaIdAtiva: 'emp-1',
  ...overrides,
});

const fakeProposta = (overrides: Record<string, unknown> = {}) => ({
  id: 'prop-1',
  empresaId: 'emp-1',
  numero: 'PROP-0001',
  clienteId: 'cli-1',
  representanteId: null,
  status: 'RASCUNHO',
  pedidoId: null,
  probabilidade: null,
  validoAte: null,
  formaPagamento: null,
  condicaoPagamento: null,
  prazoEntrega: null,
  subtotal: 100,
  descontoGeral: null,
  valor: 100,
  comissaoEstimada: 5,
  observacoes: null,
  convertidaEm: null,
  criadoEm: new Date('2026-01-01'),
  atualizadoEm: new Date('2026-01-01'),
  cliente: { id: 'cli-1', nome: 'Restaurante X', cnpj: null },
  itens: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PropostasService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let repScope: ReturnType<typeof makeRepScope>;
  let pricing: ReturnType<typeof makePricing>;
  let pedidoPricing: ReturnType<typeof makePedidoPricing>;
  let sequence: ReturnType<typeof makeSequence>;
  let service: PropostasService;

  beforeEach(() => {
    prisma = makePrismaMock();
    repScope = makeRepScope();
    pricing = makePricing();
    pedidoPricing = makePedidoPricing();
    sequence = makeSequence();
    service = new PropostasService(
      prisma as never,
      pricing as never,
      pedidoPricing as never,
      repScope as never,
      sequence as never,
      // C2 — export service + resend (mocks; não exercitados nestes specs)
      { gerarPdf: vi.fn(), gerarExcel: vi.fn() } as never,
      { isConfigured: vi.fn(() => false), enviar: vi.fn() } as never,
      // C3 — aceite service (mock; não exercitado nestes specs)
      { gerarLink: vi.fn(), resolverPreview: vi.fn(), registrarDecisao: vi.fn() } as never,
    );
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    const baseParams = {
      page: 1,
      limit: 20,
      sortBy: 'criadoEm' as const,
      sortOrder: 'desc' as const,
    };

    it('lança ForbiddenException quando empresaIdAtiva ausente', async () => {
      await expect(
        service.list(fakeUser({ empresaIdAtiva: null }), baseParams),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('filtra por empresaId', async () => {
      prisma.proposta.count.mockResolvedValue(0);
      prisma.proposta.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ empresaIdAtiva: 'emp-5' }), baseParams);

      const where = prisma.proposta.findMany.mock.calls[0][0].where;
      expect(where.empresaId).toBe('emp-5');
    });

    it('REP restringe por representanteId', async () => {
      prisma.proposta.count.mockResolvedValue(0);
      prisma.proposta.findMany.mockResolvedValue([]);

      await service.list(fakeUser({ role: 'REP', id: 'rep-77' }), baseParams);

      const where = prisma.proposta.findMany.mock.calls[0][0].where;
      expect(where.representanteId).toEqual({ in: ['rep-77'] });
    });

    it('filtra por status quando passado', async () => {
      prisma.proposta.count.mockResolvedValue(0);
      prisma.proposta.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, status: 'ACEITA' });

      const where = prisma.proposta.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ status: 'ACEITA' }]));
    });

    it('filtra por clienteId quando passado', async () => {
      prisma.proposta.count.mockResolvedValue(0);
      prisma.proposta.findMany.mockResolvedValue([]);

      await service.list(fakeUser(), { ...baseParams, clienteId: 'cli-42' });

      const where = prisma.proposta.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual(expect.arrayContaining([{ clienteId: 'cli-42' }]));
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe('findById', () => {
    it('retorna proposta quando encontrada', async () => {
      const prop = fakeProposta();
      prisma.proposta.findFirst.mockResolvedValue(prop);

      const result = await service.findById(fakeUser(), 'prop-1');

      expect(result).toEqual(prop);
    });

    it('lança NotFoundException quando não existe', async () => {
      prisma.proposta.findFirst.mockResolvedValue(null);

      await expect(service.findById(fakeUser(), 'nao-existe')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    // Spread defaults Zod aplicaria; em testes precisamos passar tudo
    // explicito porque o tipo TS é o INPUT validado (sem defaults).
    const baseDto = {
      clienteId: 'cli-1',
      itens: [{ produtoId: 'p-1', quantidade: 2, desconto: 0 }],
      formaPagamento: 'BOLETO' as const,
      condicaoPagamento: '30dias' as const,
      descontoGeral: 0,
      probabilidade: 50,
    };

    it('cria proposta com status RASCUNHO e número gerado', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        omieStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50 },
      ]);
      prisma.proposta.create.mockResolvedValue(
        fakeProposta({ status: 'RASCUNHO', numero: 'PROP-0001' }),
      );

      await service.create(fakeUser(), baseDto);

      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.status).toBe('RASCUNHO');
      expect(data.numero).toBe('PROP-0001');
    });

    it('REP fica como representanteId automaticamente', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-77',
        omieStatus: 'ATIVO',
      });
      prisma.produto.findMany.mockResolvedValue([
        { id: 'p-1', nome: 'Produto A', ativo: true, precoTabela: 50 },
      ]);
      prisma.proposta.create.mockResolvedValue(fakeProposta({ representanteId: 'rep-77' }));

      await service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto);

      const data = prisma.proposta.create.mock.calls[0][0].data;
      expect(data.representanteId).toBe('rep-77');
    });

    it('lança NotFoundException quando cliente não pertence à empresa', async () => {
      prisma.cliente.findFirst.mockResolvedValue(null);

      await expect(service.create(fakeUser(), baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.proposta.create).not.toHaveBeenCalled();
    });

    it('REP lança ForbiddenException para cliente fora da carteira', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: 'rep-outro',
        omieStatus: 'ATIVO',
      });

      await expect(
        service.create(fakeUser({ role: 'REP', id: 'rep-77' }), baseDto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lança BusinessRuleException quando produto não pertence à empresa', async () => {
      prisma.cliente.findFirst.mockResolvedValue({
        id: 'cli-1',
        empresaId: 'emp-1',
        representanteId: null,
        omieStatus: 'ATIVO',
      });
      // resolveItens: findMany retorna 0 produtos de 1 pedido
      prisma.produto.findMany.mockResolvedValue([]);

      await expect(service.create(fakeUser(), baseDto)).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('atualiza proposta em RASCUNHO', async () => {
      const prop = fakeProposta({ status: 'RASCUNHO' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ observacoes: 'Obs' }));

      await expect(
        service.update(fakeUser(), 'prop-1', { observacoes: 'Obs' }),
      ).resolves.toBeDefined();
    });

    it('lança BusinessRuleException para proposta ACEITA', async () => {
      const prop = fakeProposta({ status: 'ACEITA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);

      await expect(
        service.update(fakeUser(), 'prop-1', { observacoes: 'X' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
      expect(prisma.proposta.updateMany).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException para proposta RECUSADA', async () => {
      const prop = fakeProposta({ status: 'RECUSADA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);

      await expect(service.update(fakeUser(), 'prop-1', {})).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
    });

    it('usa updateMany com id E empresaId (proteção TOCTOU)', async () => {
      const prop = fakeProposta({ status: 'ENVIADA', empresaId: 'emp-1' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(prop);

      await service.update(fakeUser(), 'prop-1', {});

      const args = prisma.proposta.updateMany.mock.calls[0][0];
      expect(args.where.id).toBe('prop-1');
      expect(args.where.empresaId).toBe('emp-1');
    });
  });

  // -------------------------------------------------------------------------
  // changeStatus (máquina de estados)
  // -------------------------------------------------------------------------

  describe('changeStatus', () => {
    it('transição válida RASCUNHO → ENVIADA', async () => {
      const prop = fakeProposta({ status: 'RASCUNHO' });
      const updated = fakeProposta({ status: 'ENVIADA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(updated);

      const result = await service.changeStatus(fakeUser(), 'prop-1', { status: 'ENVIADA' });

      expect(result.status).toBe('ENVIADA');
    });

    it('transição válida ENVIADA → ACEITA', async () => {
      const prop = fakeProposta({ status: 'ENVIADA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ status: 'ACEITA' }));

      await service.changeStatus(fakeUser(), 'prop-1', { status: 'ACEITA' });

      const args = prisma.proposta.updateMany.mock.calls[0][0];
      expect(args.data.status).toBe('ACEITA');
    });

    it('transição inválida RASCUNHO → ACEITA → BusinessRuleException', async () => {
      const prop = fakeProposta({ status: 'RASCUNHO' });
      prisma.proposta.findFirst.mockResolvedValue(prop);

      await expect(
        service.changeStatus(fakeUser(), 'prop-1', { status: 'ACEITA' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('transição de status final ACEITA → ENVIADA → BusinessRuleException', async () => {
      const prop = fakeProposta({ status: 'ACEITA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);

      await expect(
        service.changeStatus(fakeUser(), 'prop-1', { status: 'ENVIADA' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('EXPIRADA pode ser reenviada → EXPIRADA → ENVIADA é válida', async () => {
      const prop = fakeProposta({ status: 'EXPIRADA' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ status: 'ENVIADA' }));

      await expect(
        service.changeStatus(fakeUser(), 'prop-1', { status: 'ENVIADA' }),
      ).resolves.toBeDefined();
    });

    it('appends motivo às observacoes quando fornecido', async () => {
      const prop = fakeProposta({ status: 'ENVIADA', observacoes: 'Nota inicial' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ status: 'RECUSADA' }));

      await service.changeStatus(fakeUser(), 'prop-1', {
        status: 'RECUSADA',
        motivo: 'Preço alto',
      });

      const args = prisma.proposta.updateMany.mock.calls[0][0];
      expect(args.data.observacoes).toContain('Nota inicial');
      expect(args.data.observacoes).toContain('RECUSADA');
      expect(args.data.observacoes).toContain('Preço alto');
    });

    it('usa updateMany com id E empresaId (proteção TOCTOU)', async () => {
      const prop = fakeProposta({ status: 'RASCUNHO', empresaId: 'emp-1' });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      prisma.proposta.updateMany.mockResolvedValue({ count: 1 });
      prisma.proposta.findUniqueOrThrow.mockResolvedValue(fakeProposta({ status: 'ENVIADA' }));

      await service.changeStatus(fakeUser(), 'prop-1', { status: 'ENVIADA' });

      const args = prisma.proposta.updateMany.mock.calls[0][0];
      expect(args.where.empresaId).toBe('emp-1');
    });
  });

  // -------------------------------------------------------------------------
  // converterEmPedido
  // -------------------------------------------------------------------------

  describe('converterEmPedido', () => {
    it('converte proposta ACEITA em pedido via transação', async () => {
      const prop = fakeProposta({
        status: 'ACEITA',
        pedidoId: null,
        itens: [
          {
            produtoId: 'p-1',
            quantidade: 2,
            precoUnitario: 50,
            desconto: 0,
            total: 100,
            negociado: false,
          },
        ],
      });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      sequence.next.mockResolvedValue(7);

      const txMock = prisma._tx;
      txMock.pedido.create.mockResolvedValue({ id: 'ped-new', numero: 'PED-0007' });
      txMock.proposta.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.converterEmPedido(fakeUser(), 'prop-1');

      expect(result).toEqual({ pedidoId: 'ped-new', numero: 'PED-0007' });
    });

    it('número do pedido usa padding de 4 dígitos', async () => {
      const prop = fakeProposta({ status: 'ACEITA', pedidoId: null, itens: [] });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      sequence.next.mockResolvedValue(3);

      const txMock = prisma._tx;
      txMock.pedido.create.mockResolvedValue({ id: 'ped-x', numero: 'PED-0003' });
      txMock.proposta.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.converterEmPedido(fakeUser(), 'prop-1');

      expect(result.numero).toBe('PED-0003');
    });

    it('lança BusinessRuleException se proposta não está ACEITA', async () => {
      prisma.proposta.findFirst.mockResolvedValue(fakeProposta({ status: 'ENVIADA' }));

      await expect(service.converterEmPedido(fakeUser(), 'prop-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lança BusinessRuleException se proposta já foi convertida', async () => {
      prisma.proposta.findFirst.mockResolvedValue(
        fakeProposta({ status: 'ACEITA', pedidoId: 'ped-existente' }),
      );

      await expect(service.converterEmPedido(fakeUser(), 'prop-1')).rejects.toBeInstanceOf(
        BusinessRuleException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('vincula pedidoId na proposta dentro da transação', async () => {
      const prop = fakeProposta({ status: 'ACEITA', pedidoId: null, itens: [] });
      prisma.proposta.findFirst.mockResolvedValue(prop);
      sequence.next.mockResolvedValue(1);

      const txMock = prisma._tx;
      txMock.pedido.create.mockResolvedValue({ id: 'ped-123', numero: 'PED-0001' });
      txMock.proposta.updateMany.mockResolvedValue({ count: 1 });

      await service.converterEmPedido(fakeUser(), 'prop-1');

      expect(txMock.proposta.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ pedidoId: 'ped-123' }),
        }),
      );
    });
  });
});
